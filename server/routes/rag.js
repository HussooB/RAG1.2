import express from "express";
import multer from "multer";
import { ingestText, ingestPDF, query } from "../controllers/ragController.js";

const router = express.Router();
const upload = multer(); // in-memory storage

router.post("/ingest-text", express.json(), ingestText);
router.post("/ingest-pdf", upload.single("pdf"), ingestPDF);
router.post("/query", express.json(), query);

export default router;
