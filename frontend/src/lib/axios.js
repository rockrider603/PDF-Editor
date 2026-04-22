import axios from "axios";

//axios helps you talk to the server.
export const axiosInstance = axios.create({
  baseURL: import.meta.env.MODE === "development" ? "http://localhost:5001/api" : "/api",
  withCredentials: true,
});

/*
PDF Editor API Endpoints:
POST   /pdf/upload           - Upload PDF (multipart/form-data)
GET    /pdf/list             - Get all PDFs
GET    /pdf/:id              - Get specific PDF
PUT    /pdf/:id              - Update PDF metadata
DELETE /pdf/:id              - Delete PDF
GET    /pdf/:id/download     - Download edited PDF
*/