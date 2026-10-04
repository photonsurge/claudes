import { addA1Refs, applyGuess, generateCrossword, getCandidateDirs, getWinner, isGameCompleteByGrid, isStartCellAny, parseA1, renderPlayerGridSVGModern, slotKey } from "./crossword";
import { readFile, writeFile } from "fs/promises";
import { createServer } from "http";
import { Server } from "socket.io";
import { Direction, iCrosswordWord, Puzzle } from "./crossword-types";
import { pickRandomItems } from "./words";



let puzzle: Puzzle;



process.on("uncaughtException", (err: any) => {
  console.error("💥 uncaughtException:");
  console.error(err);
  console.error("type:", typeof err);
  console.error("keys:", err && typeof err === "object" ? Object.keys(err) : null);
  console.error("stack:", err?.stack);
});

process.on("unhandledRejection", (reason: any) => {
  console.error("💥 unhandledRejection:");
  console.error(reason);
  console.error("type:", typeof reason);
  console.error("keys:", reason && typeof reason === "object" ? Object.keys(reason) : null);
});

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "*", // lock this down in prod
  },
});

/*

H3 down: PERIHELION
F3 across: SUPERNOVA
F3 down: SOLSTICE
J2 down: GRAVITY
A6 across: CYGNUS
*/

const initCrossword = async () => {
  const dstr = await readFile("./data.json", "utf8");
  const data: iCrosswordWord[] = JSON.parse(dstr);



  console.log("data", data)

  //console.log(randomTen)

  console.log("data", data)




  // const words = randomTen.map(d => d.word.toUpperCase())

  // const puzzle = generateCrossword(words, {
  //   maxSize: 15,
  //   maxAttempts: 200,
  //   cellSize: 36,
  //   showLetters: false, // blank sheet
  // });


  console.log(data.length)

  const gen = generateCrossword(data, {
    maxSize:50,
    maxAttempts: 500,
    showLetters: true, // blank sheet
  });


  const placementsWithRefs = addA1Refs(gen.placements);
  for (const p of placementsWithRefs) {
    console.log(`${p.startRef} ${p.dir}: ${p.word}`);
  }
  //console.log(placementsWithRefs.length)
  puzzle = {
    width: gen.width,
    height: gen.height,
    placements: placementsWithRefs,
    solutionGrid: gen.grid,
    playerGrid: gen.grid.map(row => row.map(cell => (cell === null ? null : ""))),
    solvedSlots: new Set<string>(),
    score: {}, // optional if you’re tracking scores
  };

  return await renderGame();
}


const renderGame = async () => {
  if (!puzzle) {
    return;
  }

  /// console.log(puzzle.playerGrid)
  const winner = getWinner(puzzle.score);
  const complete = isGameCompleteByGrid(puzzle)

  const aaa: any = {
    cellSize: 40,
    showAxis: true,
    title: "Crossword",
    subtitle: "Space!",
    score: puzzle.score,              // <-- HERE
    highlightPlayer: "rich",          // optional

  }

  if (winner.length !== 0 && complete) {
    aaa.overlay = { title: `WOOP ${winner}!`, message: "Well done — you won 🏆" }
  }
  const svg = renderPlayerGridSVGModern(puzzle.playerGrid, aaa);

  await writeFile("./crossword-live.svg", svg, "utf8");

  return svg;

}






io.on("connection", async (socket) => {
  console.log("Client connected:", socket.id);

  //Emit current svg to client

  const svg = await renderGame()
  socket.emit("startSvg", { svg })
  socket.emit("svg", { svg })
  // listen for messages
  socket.on("message", (data) => {
    console.log("Message received:", data);

    // send back to sender
    socket.emit("message", {
      echo: data,
    });

    // or broadcast to everyone
    // io.emit("message", data);
  });

  socket.on("clue", (data) => {
    console.log("Clue Request received:", data);
    const { userID, userName, } = data

    const d = puzzle.placements.find(sd => sd.startRef === data.ref.toUpperCase())

    if (!d) {
      io.emit('message', { userID, userName, text: 'Not a valid start', from: 'puzzle-master' })
      return;
    }




    console.log(d.entry.clue)
    // // send back to sender
    // socket.emit("message", {
    //   echo: data,
    // });

    // or broadcast to everyone
    // io.emit("message", data);

    io.emit('message', { userID, userName, text: `A clue for \n${data.ref.toUpperCase()}, ${d.entry.clue}`, from: 'puzzle-master' })
  });
  // listen for messages
  socket.on("restart", async (data) => {
    // const complete = isGameCompleteByGrid(puzzle)
    // if (!complete) {
    //   console.log("Sorry Game is not finished")
    // }
    const { userID, userName, } = data
    console.log("restarting crossword")

    const svg = await initCrossword();
    io.emit('message', { userID, userName, text: 'Restarting Game', from: 'puzzle-master' })
    io.emit("svg", { svg })
  });
  socket.on("guess", async (data) => {
    console.log("guess received:", data.text);

    const { userID, ref, word, userName } = data;


    const complete = isGameCompleteByGrid(puzzle)
    if (complete) {
      console.log("Sorry Game has already finished")
      return;
    }

    const res = applyGuess(puzzle, ref, word);


    console.log(res)
    if (res.ok===false) {
      console.log("failed")
      socket.emit('message', {
        userID: userID,
        userName: userName,
        text: 'Sorry that failed ' + res.reason,
        from: 'puzzle-master',
      });

      return;
    }
    const key = slotKey(ref, res.dir);
    console.log("success")

    //sucesss
    // prevent re-solving
    if (puzzle.solvedSlots.has(key)) {
      console.log("Already Answered")
      socket.emit('message', { userID, userName, text: 'Already answered', from: 'puzzle-master' })
      //   ws.send(JSON.stringify({ type: "guessResult", ok: false, reason: "Already solved" }));
      return;
    }

    puzzle.solvedSlots.add(key);
    puzzle.score[userName] = (puzzle.score[userName] ?? 0) + 1;
    const complete2 = isGameCompleteByGrid(puzzle)
    if (complete2) {
      socket.emit('message', { userID, userName, text: '+1 point. The game has finished!', from: 'puzzle-master' })
    } else {
      socket.emit('message', { userID, userName, text: '+1 point', from: 'puzzle-master' })
    }

    const svg = await renderGame();

    io.emit("svg", { svg })

    // // send back to sender
    // socket.emit("message", {
    //   echo: data,
    // });

    // or broadcast to everyone
    // io.emit("message", data);
  });
  socket.on("disconnect", (reason) => {
    console.log("Client disconnected:", socket.id, reason);
  });
});

httpServer.listen(3001, async () => {
  console.log("Socket.IO server listening on port 3001");


  console.log("starting crosswords")

  initCrossword();
});
