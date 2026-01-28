import { describe, expect, test } from "vitest";

import {
  countTextDocuments,
  hasSupportedExtension,
  isSupportedDocumentType,
  isTextDocument,
} from "./knowledge-graph";

describe("isSupportedDocumentType", () => {
  test("returns true for supported MIME types", () => {
    expect(isSupportedDocumentType("text/plain")).toBe(true);
    expect(isSupportedDocumentType("text/markdown")).toBe(true);
    expect(isSupportedDocumentType("application/json")).toBe(true);
    expect(isSupportedDocumentType("text/csv")).toBe(true);
    expect(isSupportedDocumentType("text/html")).toBe(true);
    expect(isSupportedDocumentType("text/javascript")).toBe(true);
    expect(isSupportedDocumentType("application/javascript")).toBe(true);
    expect(isSupportedDocumentType("application/pdf")).toBe(true);
  });

  test("returns true for MIME types with parameters", () => {
    expect(isSupportedDocumentType("text/plain;charset=utf-8")).toBe(true);
    expect(isSupportedDocumentType("application/json; charset=UTF-8")).toBe(
      true,
    );
    expect(isSupportedDocumentType("text/html; charset=iso-8859-1")).toBe(true);
  });

  test("returns false for unsupported MIME types", () => {
    expect(isSupportedDocumentType("image/png")).toBe(false);
    expect(isSupportedDocumentType("image/jpeg")).toBe(false);
    expect(isSupportedDocumentType("audio/mp3")).toBe(false);
    expect(isSupportedDocumentType("video/mp4")).toBe(false);
    expect(isSupportedDocumentType("application/octet-stream")).toBe(false);
  });

  test("returns false for null or undefined", () => {
    expect(isSupportedDocumentType(null)).toBe(false);
    expect(isSupportedDocumentType(undefined)).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isSupportedDocumentType("")).toBe(false);
  });
});

describe("hasSupportedExtension", () => {
  test("returns true for supported text file extensions", () => {
    expect(hasSupportedExtension("document.txt")).toBe(true);
    expect(hasSupportedExtension("readme.md")).toBe(true);
    expect(hasSupportedExtension("data.json")).toBe(true);
    expect(hasSupportedExtension("data.csv")).toBe(true);
    expect(hasSupportedExtension("page.html")).toBe(true);
    expect(hasSupportedExtension("config.yaml")).toBe(true);
    expect(hasSupportedExtension("config.yml")).toBe(true);
  });

  test("returns true for supported code file extensions", () => {
    expect(hasSupportedExtension("app.js")).toBe(true);
    expect(hasSupportedExtension("app.ts")).toBe(true);
    expect(hasSupportedExtension("component.tsx")).toBe(true);
    expect(hasSupportedExtension("script.py")).toBe(true);
    expect(hasSupportedExtension("main.go")).toBe(true);
    expect(hasSupportedExtension("lib.rs")).toBe(true);
    expect(hasSupportedExtension("query.sql")).toBe(true);
    expect(hasSupportedExtension("style.css")).toBe(true);
  });

  test("returns true for case-insensitive matching", () => {
    expect(hasSupportedExtension("README.MD")).toBe(true);
    expect(hasSupportedExtension("Config.JSON")).toBe(true);
    expect(hasSupportedExtension("SCRIPT.PY")).toBe(true);
  });

  test("returns true for PDF extension", () => {
    expect(hasSupportedExtension("document.pdf")).toBe(true);
    expect(hasSupportedExtension("REPORT.PDF")).toBe(true);
  });

  test("returns false for unsupported extensions", () => {
    expect(hasSupportedExtension("photo.png")).toBe(false);
    expect(hasSupportedExtension("image.jpg")).toBe(false);
    expect(hasSupportedExtension("image.jpeg")).toBe(false);
    expect(hasSupportedExtension("song.mp3")).toBe(false);
    expect(hasSupportedExtension("video.mp4")).toBe(false);
    expect(hasSupportedExtension("archive.zip")).toBe(false);
    expect(hasSupportedExtension("binary.exe")).toBe(false);
  });

  test("returns false for null or undefined", () => {
    expect(hasSupportedExtension(null)).toBe(false);
    expect(hasSupportedExtension(undefined)).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(hasSupportedExtension("")).toBe(false);
  });

  test("returns false for filename without extension", () => {
    expect(hasSupportedExtension("filename")).toBe(false);
    expect(hasSupportedExtension("noextension")).toBe(false);
  });
});

describe("isTextDocument", () => {
  test("returns true when MIME type is supported", () => {
    expect(isTextDocument({ mediaType: "text/plain" })).toBe(true);
    expect(isTextDocument({ mediaType: "application/json" })).toBe(true);
  });

  test("returns true when extension is supported", () => {
    expect(isTextDocument({ filename: "readme.md" })).toBe(true);
    expect(isTextDocument({ name: "script.py" })).toBe(true);
  });

  test("returns true when either MIME type or extension is supported", () => {
    // Unsupported MIME type but supported extension
    expect(
      isTextDocument({
        mediaType: "application/octet-stream",
        filename: "data.json",
      }),
    ).toBe(true);

    // Supported MIME type but no extension
    expect(isTextDocument({ mediaType: "text/plain", filename: "noext" })).toBe(
      true,
    );
  });

  test("returns false for image files", () => {
    expect(
      isTextDocument({ mediaType: "image/png", filename: "photo.png" }),
    ).toBe(false);
    expect(
      isTextDocument({ mediaType: "image/jpeg", filename: "image.jpg" }),
    ).toBe(false);
  });

  test("returns true for PDF files", () => {
    expect(
      isTextDocument({ mediaType: "application/pdf", filename: "doc.pdf" }),
    ).toBe(true);
  });

  test("returns false for audio files", () => {
    expect(
      isTextDocument({ mediaType: "audio/mp3", filename: "song.mp3" }),
    ).toBe(false);
  });

  test("returns false for video files", () => {
    expect(
      isTextDocument({ mediaType: "video/mp4", filename: "video.mp4" }),
    ).toBe(false);
  });

  test("prefers filename over name property", () => {
    expect(isTextDocument({ filename: "script.py", name: "image.png" })).toBe(
      true,
    );
  });

  test("falls back to name property when filename is not present", () => {
    expect(isTextDocument({ name: "script.py" })).toBe(true);
    expect(isTextDocument({ name: "image.png" })).toBe(false);
  });

  test("returns false for empty object", () => {
    expect(isTextDocument({})).toBe(false);
  });
});

describe("countTextDocuments", () => {
  test("returns 0 for empty array", () => {
    expect(countTextDocuments([])).toBe(0);
  });

  test("counts only text documents", () => {
    const files = [
      { mediaType: "text/plain", filename: "doc.txt" },
      { mediaType: "image/png", filename: "photo.png" },
      { mediaType: "application/json", filename: "data.json" },
    ];
    expect(countTextDocuments(files)).toBe(2);
  });

  test("returns 0 when no supported documents present", () => {
    const files = [
      { mediaType: "image/png", filename: "photo.png" },
      { mediaType: "image/jpeg", filename: "image.jpg" },
      { mediaType: "video/mp4", filename: "video.mp4" },
    ];
    expect(countTextDocuments(files)).toBe(0);
  });

  test("counts PDF documents", () => {
    const files = [
      { mediaType: "application/pdf", filename: "doc.pdf" },
      { mediaType: "image/png", filename: "photo.png" },
    ];
    expect(countTextDocuments(files)).toBe(1);
  });

  test("returns total count when all files are text documents", () => {
    const files = [
      { mediaType: "text/plain", filename: "doc.txt" },
      { mediaType: "text/markdown", filename: "readme.md" },
      { mediaType: "application/json", filename: "data.json" },
    ];
    expect(countTextDocuments(files)).toBe(3);
  });

  test("handles mixed files with extension-only matching", () => {
    const files = [
      { mediaType: "application/octet-stream", filename: "script.py" }, // supported by extension
      { mediaType: "image/png", filename: "photo.png" }, // not supported
      { mediaType: "application/octet-stream", filename: "code.ts" }, // supported by extension
    ];
    expect(countTextDocuments(files)).toBe(2);
  });

  test("handles files with only name property", () => {
    const files = [
      { name: "script.py" },
      { name: "photo.png" },
      { name: "readme.md" },
    ];
    expect(countTextDocuments(files)).toBe(2);
  });
});
