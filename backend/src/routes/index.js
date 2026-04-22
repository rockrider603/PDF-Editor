const express = require('express');
const pdfRoutes = require('./pdfRoutes');

const router = express.Router();

// Mount all route modules
router.use('/', pdfRoutes);

module.exports = router;