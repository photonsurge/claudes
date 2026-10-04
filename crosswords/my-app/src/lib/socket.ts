import { io } from "socket.io-client";


export const socket = io({
  path: "/socket.io",
  autoConnect: false,
  transports: ["websocket"],
});