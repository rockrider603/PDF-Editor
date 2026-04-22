# PDF Editor Backend

Express.js API server for the PDF Editor application.

## Features

- PDF upload and processing
- MongoDB integration for metadata storage
- File storage management
- RESTful API endpoints
- Error handling and validation

## Prerequisites

- Node.js (v16 or higher)
- MongoDB (local or cloud instance)
- npm or yarn

## Installation

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Copy `.env` file and update the values:
```bash
cp .env.example .env
```

4. Start MongoDB (if running locally)

5. Start the server:
```bash
npm run dev  # Development mode with nodemon
npm start    # Production mode
```

The server will run on `http://localhost:5001`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pdf/upload` | Upload a PDF file |
| GET | `/api/pdf/list` | Get all uploaded PDFs |
| GET | `/api/pdf/:id` | Get specific PDF by ID |
| PUT | `/api/pdf/:id` | Update PDF metadata |
| DELETE | `/api/pdf/:id` | Delete PDF |
| GET | `/api/pdf/:id/download` | Download PDF file |
| GET | `/api/health` | Health check |

## Environment Variables

- `NODE_ENV`: Environment (development/production)
- `PORT`: Server port (default: 5001)
- `MONGODB_URI`: MongoDB connection string
- `FRONTEND_URL`: Frontend application URL
- `MAX_FILE_SIZE`: Maximum file size in bytes
- `UPLOAD_PATH`: Path for file uploads

## File Structure

```
backend/
├── config/
│   └── database.js          # Database configuration
├── src/
│   ├── middleware/
│   │   ├── authMiddleware.js    # Authentication
│   │   ├── errorHandler.js      # Error handling
│   │   └── uploadMiddleware.js  # File upload config
│   ├── models/
│   │   ├── PDF.js               # PDF model
│   │   └── index.js             # Model exports
│   ├── routes/
│   │   ├── pdfRoutes.js         # PDF routes
│   │   └── index.js             # Route exports
│   ├── pdf/
│   │   ├── controllers/
│   │   │   └── pdfController.js # PDF business logic
│   │   └── [existing PDF processing files]
│   └── uploads/                 # Uploaded files
├── .env                        # Environment variables
├── package.json                # Dependencies
├── server.js                   # Main server file
└── README.md                   # This file
```

## Development

- Uses `nodemon` for auto-restart during development
- Includes CORS configuration for frontend integration
- Rate limiting for API protection
- File size limits and validation