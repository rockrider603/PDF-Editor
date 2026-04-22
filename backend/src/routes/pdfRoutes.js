const express = require('express');
const {
  uploadPDF,
  getPDFs,
  getPDFById,
  updatePDF,
  deletePDF,
  downloadPDF
} = require('../pdf/controllers/pdfController');
const upload = require('../middleware/uploadMiddleware');

const router = express.Router();

// Routes
router.post('/pdf/upload', upload.single('pdf'), uploadPDF);
router.get('/pdf/list', getPDFs);
router.get('/pdf/:id', getPDFById);
router.put('/pdf/:id', updatePDF);
router.delete('/pdf/:id', deletePDF);
router.get('/pdf/:id/download', downloadPDF);

module.exports = router;