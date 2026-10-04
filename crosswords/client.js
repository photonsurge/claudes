import { io } from "socket.io-client";
const args = process.argv.slice(2);
console.log(args.length)
if(args.length !== 3){
    console.log("node client.js ravergeek@gmail.com A1 across ALARM")
    process.exit(1);
    
}
const [userID, ref, word] = args;

console.log({userID, ref, word });



const socket = io("http://192.168.0.179:3001", { transports: ["websocket"] });

socket.on("connect", () => {
  console.log("connected", socket.id);
  socket.emit("guess", {userID, ref, word });
  setTimeout(() => process.exit(0), 500);
});

socket.on("connect_error", (e) => {
  console.error("connect_error", e.message);
  process.exit(1);
});