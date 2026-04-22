const { extractAndTranslatePdf } = require('../extractAndTranslatePdf');
const PDF = require('../../models/PDF');
const path = require('path');
const fs = require('fs').promises;

// Upload and process PDF
const uploadPDF = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No PDF file provided' });
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;
    const fileSize = req.file.size;

    // Process the PDF using your existing logic
    console.log('Processing PDF:', originalName);
    await extractAndTranslatePdf(filePath);

    // Create PDF metadata record
    const pdfData = {
      originalName,
      filePath,
      fileSize,
      processedAt: new Date(),
      status: 'processed'
    };

    const pdf = new PDF(pdfData);
    await pdf.save();

    res.status(201).json({
      _id: pdf._id,
      originalName: pdf.originalName,
      fileSize: pdf.fileSize,
      processedAt: pdf.processedAt,
      status: pdf.status
    });

  } catch (error) {
    console.error('PDF upload error:', error);
    res.status(500).json({ message: 'Failed to process PDF' });
  }
};

// Get all PDFs
const getPDFs = async (req, res) => {
  try {
    const pdfs = await PDF.find().sort({ processedAt: -1 });
    res.json(pdfs);
  } catch (error) {
    console.error('Error fetching PDFs:', error);
    res.status(500).json({ message: 'Failed to fetch PDFs' });
  }
};

// Get specific PDF by ID
const getPDFById = async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    if (!pdf) {
      return res.status(404).json({ message: 'PDF not found' });
    }
    res.json(pdf);
  } catch (error) {
    console.error('Error fetching PDF:', error);
    res.status(500).json({ message: 'Failed to fetch PDF' });
  }
};

// Update PDF metadata
const updatePDF = async (req, res) => {
  try {
    const { title, description } = req.body;
    const pdf = await PDF.findByIdAndUpdate(
      req.params.id,
      { title, description, updatedAt: new Date() },
      { new: true }
    );

    if (!pdf) {
      return res.status(404).json({ message: 'PDF not found' });
    }

    res.json(pdf);
  } catch (error) {
    console.error('Error updating PDF:', error);
    res.status(500).json({ message: 'Failed to update PDF' });
  }
};

// Delete PDF
const deletePDF = async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    if (!pdf) {
      return res.status(404).json({ message: 'PDF not found' });
    }

    // Delete the file from filesystem
    try {
      await fs.unlink(pdf.filePath);
    } catch (fileError) {
      console.warn('Could not delete file:', fileError);
    }

    // Delete from database
    await PDF.findByIdAndDelete(req.params.id);

    res.json({ message: 'PDF deleted successfully' });
  } catch (error) {
    console.error('Error deleting PDF:', error);
    res.status(500).json({ message: 'Failed to delete PDF' });
  }
};

// Download PDF
const downloadPDF = async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    if (!pdf) {
      return res.status(404).json({ message: 'PDF not found' });
    }

    // Check if file exists
    try {
      await fs.access(pdf.filePath);
    } catch {
      return res.status(404).json({ message: 'PDF file not found on server' });
    }

    // Set headers for download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdf.originalName}"`);

    // Stream the file
    const fileStream = require('fs').createReadStream(pdf.filePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Error downloading PDF:', error);
    res.status(500).json({ message: 'Failed to download PDF' });
  }
};

module.exports = {
  uploadPDF,
  getPDFs,
  getPDFById,
  updatePDF,
  deletePDF,
  downloadPDF
};