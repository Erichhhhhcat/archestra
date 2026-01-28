/**
 * Shared constants and utilities for knowledge graph document handling.
 * Used by both frontend (to filter UI indicators) and backend (for ingestion).
 */

/**
 * Supported document MIME types for knowledge graph ingestion.
 * These are formats that can be meaningfully indexed (text-based and PDFs).
 */
export const SUPPORTED_DOCUMENT_TYPES = [
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/json",
  "text/csv",
  "text/xml",
  "application/xml",
  "text/html",
  "text/yaml",
  "application/x-yaml",
  // Common code files
  "text/javascript",
  "application/javascript",
  "text/typescript",
  "text/x-python",
  "text/x-java",
  "text/x-c",
  "text/x-cpp",
  // PDF documents
  "application/pdf",
] as const;

/**
 * File extensions that map to supported document types.
 * Used as fallback when MIME type is generic or missing.
 */
export const SUPPORTED_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".xml",
  ".html",
  ".htm",
  ".yaml",
  ".yml",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".py",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".rs",
  ".go",
  ".rb",
  ".php",
  ".sh",
  ".bash",
  ".sql",
  ".graphql",
  ".css",
  ".scss",
  ".less",
  ".pdf",
] as const;

export type SupportedDocumentType = (typeof SUPPORTED_DOCUMENT_TYPES)[number];
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

/**
 * Checks if a MIME type is supported for knowledge graph ingestion.
 * Handles MIME type parameters (e.g., "text/plain;charset=utf-8" matches "text/plain").
 *
 * @param mediaType - The MIME type to check
 * @returns true if the MIME type is supported
 */
export function isSupportedDocumentType(
  mediaType: string | undefined | null,
): boolean {
  if (!mediaType) {
    return false;
  }

  // Extract base MIME type (ignore parameters like charset)
  const baseType = mediaType.split(";")[0].trim().toLowerCase();
  return SUPPORTED_DOCUMENT_TYPES.includes(baseType as SupportedDocumentType);
}

/**
 * Checks if a filename has a supported extension for knowledge graph ingestion.
 *
 * @param filename - The filename to check
 * @returns true if the extension is supported
 */
export function hasSupportedExtension(
  filename: string | undefined | null,
): boolean {
  if (!filename) {
    return false;
  }

  const lowerFilename = filename.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lowerFilename.endsWith(ext));
}

/**
 * File info type that supports both 'name' and 'filename' properties.
 * This allows compatibility with different file object structures.
 */
export interface FileInfo {
  mediaType?: string | null;
  /** Standard name property */
  name?: string | null;
  /** Alternative filename property (used by some UI components) */
  filename?: string | null;
}

/**
 * Gets the filename from a file object, checking both 'filename' and 'name' properties.
 */
function getFilename(file: FileInfo): string | null | undefined {
  return file.filename ?? file.name;
}

/**
 * Checks if a file is a supported document for knowledge graph ingestion.
 * A file is considered supported if either its MIME type or extension matches.
 * Supports text-based formats and PDFs.
 *
 * @param file - Object containing optional mediaType and name/filename properties
 * @returns true if the file is a supported document
 */
export function isTextDocument(file: FileInfo): boolean {
  return (
    isSupportedDocumentType(file.mediaType) ||
    hasSupportedExtension(getFilename(file))
  );
}

/**
 * Counts the number of text documents in a list of files.
 *
 * @param files - Array of file objects with optional mediaType and name/filename properties
 * @returns The count of files that are supported text documents
 */
export function countTextDocuments(files: FileInfo[]): number {
  return files.filter(isTextDocument).length;
}
