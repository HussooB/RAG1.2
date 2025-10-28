import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { initQdrant } from "./config/qdrantClient.js";
import ragRoutes from "./routes/rag.js";

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

await initQdrant();

app.use("/api/rag", ragRoutes);
app.get("/", (req, res) => res.send("RAG API ready"));

const port = process.env.PORT || 5111;
app.listen(port, () => console.log(`http://localhost:${port}`));
