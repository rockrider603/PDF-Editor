import { create } from "zustand";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios.js";

export const usePDFStore = create((set, get) => ({
  pdfs: [],
  currentPDF: null,
  isLoading: false,
  isUploading: false,
  uploadProgress: 0,
  error: null,
  pdfContent: null,

  uploadPDF: async (file) => {
    set({ isUploading: true, uploadProgress: 0, error: null });
    
    const formData = new FormData();
    formData.append("pdf", file);

    try {
      const res = await axiosInstance.post("/pdf/upload", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          set({ uploadProgress: percentCompleted });
        },
      });

      set({
        currentPDF: res.data,
        pdfs: [...get().pdfs, res.data],
        uploadProgress: 100,
      });

      toast.success("PDF uploaded successfully!");
      return res.data;
    } catch (error) {
      const errorMessage = error.response?.data?.message || "Failed to upload PDF";
      set({ error: errorMessage });
      toast.error(errorMessage);
      throw error;
    } finally {
      set({ isUploading: false });
    }
  },

  getPDFs: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await axiosInstance.get("/pdf/list");
      set({ pdfs: res.data || [] });
    } catch (error) {
      const errorMessage = error.response?.data?.message || "Failed to fetch PDFs";
      set({ error: errorMessage });
      toast.error(errorMessage);
    } finally {
      set({ isLoading: false });
    }
  },

  getPDFById: async (pdfId) => {
    set({ isLoading: true, error: null });
    try {
      const res = await axiosInstance.get(`/pdf/${pdfId}`);
      set({ currentPDF: res.data, pdfContent: res.data });
      return res.data;
    } catch (error) {
      const errorMessage = error.response?.data?.message || "Failed to fetch PDF";
      set({ error: errorMessage });
      toast.error(errorMessage);
    } finally {
      set({ isLoading: false });
    }
  },

  deletePDF: async (pdfId) => {
    set({ error: null });
    try {
      await axiosInstance.delete(`/pdf/${pdfId}`);
      set({
        pdfs: get().pdfs.filter((pdf) => pdf._id !== pdfId),
        currentPDF: get().currentPDF?._id === pdfId ? null : get().currentPDF,
      });
      toast.success("PDF deleted successfully!");
    } catch (error) {
      const errorMessage = error.response?.data?.message || "Failed to delete PDF";
      set({ error: errorMessage });
      toast.error(errorMessage);
    }
  },

  updatePDFMetadata: async (pdfId, metadata) => {
    set({ isLoading: true, error: null });
    try {
      const res = await axiosInstance.put(`/pdf/${pdfId}`, metadata);
      const updatedPDFs = get().pdfs.map((pdf) =>
        pdf._id === pdfId ? res.data : pdf
      );
      set({
        pdfs: updatedPDFs,
        currentPDF: res.data,
      });
      toast.success("PDF metadata updated!");
      return res.data;
    } catch (error) {
      const errorMessage = error.response?.data?.message || "Failed to update PDF";
      set({ error: errorMessage });
      toast.error(errorMessage);
    } finally {
      set({ isLoading: false });
    }
  },

  setCurrentPDF: (pdf) => set({ currentPDF: pdf }),
  clearError: () => set({ error: null }),
  resetUploadProgress: () => set({ uploadProgress: 0 }),
}));