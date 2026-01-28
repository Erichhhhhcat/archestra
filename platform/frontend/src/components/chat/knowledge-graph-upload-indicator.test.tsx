import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { KnowledgeGraphUploadIndicator } from "./knowledge-graph-upload-indicator";

// Mock the features hook
vi.mock("@/lib/features.hook", () => ({
  useFeatureValue: vi.fn(),
}));

import { useFeatureValue } from "@/lib/features.hook";

describe("KnowledgeGraphUploadIndicator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("renders nothing when knowledge graph is not enabled", () => {
    vi.mocked(useFeatureValue).mockReturnValue(null);

    const { container } = render(
      <KnowledgeGraphUploadIndicator
        files={[{ mediaType: "text/plain", filename: "test.txt" }]}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  test("renders nothing when no files are attached", () => {
    vi.mocked(useFeatureValue).mockReturnValue({
      enabled: true,
      displayName: "Test KG",
    });

    const { container } = render(<KnowledgeGraphUploadIndicator files={[]} />);

    expect(container.firstChild).toBeNull();
  });

  test("renders nothing when only unsupported files are attached", () => {
    vi.mocked(useFeatureValue).mockReturnValue({
      enabled: true,
      displayName: "Test KG",
    });

    const { container } = render(
      <KnowledgeGraphUploadIndicator
        files={[
          { mediaType: "image/png", filename: "photo.png" },
          { mediaType: "image/jpeg", filename: "image.jpg" },
          { mediaType: "video/mp4", filename: "video.mp4" },
        ]}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  test("renders indicator for PDF files", () => {
    vi.mocked(useFeatureValue).mockReturnValue({
      enabled: true,
      displayName: "Test KG",
    });

    render(
      <KnowledgeGraphUploadIndicator
        files={[{ mediaType: "application/pdf", filename: "document.pdf" }]}
      />,
    );

    expect(screen.getByText("KG Upload")).toBeInTheDocument();
  });

  test("renders indicator when text files are attached", () => {
    vi.mocked(useFeatureValue).mockReturnValue({
      enabled: true,
      displayName: "Test KG",
    });

    render(
      <KnowledgeGraphUploadIndicator
        files={[{ mediaType: "text/plain", filename: "test.txt" }]}
      />,
    );

    expect(screen.getByText("KG Upload")).toBeInTheDocument();
  });

  test("renders indicator for code files", () => {
    vi.mocked(useFeatureValue).mockReturnValue({
      enabled: true,
      displayName: "Test KG",
    });

    render(
      <KnowledgeGraphUploadIndicator
        files={[
          { mediaType: "application/octet-stream", filename: "script.py" },
        ]}
      />,
    );

    expect(screen.getByText("KG Upload")).toBeInTheDocument();
  });

  test("counts only supported documents in mixed file list", () => {
    vi.mocked(useFeatureValue).mockReturnValue({
      enabled: true,
      displayName: "Test KG",
    });

    render(
      <KnowledgeGraphUploadIndicator
        files={[
          { mediaType: "text/plain", filename: "doc.txt" },
          { mediaType: "image/png", filename: "photo.png" },
          { mediaType: "application/json", filename: "data.json" },
          { mediaType: "application/pdf", filename: "document.pdf" },
        ]}
      />,
    );

    // Should render since there are 3 supported documents (txt, json, pdf)
    expect(screen.getByText("KG Upload")).toBeInTheDocument();
  });

  test("renders indicator when files have only extension (octet-stream)", () => {
    vi.mocked(useFeatureValue).mockReturnValue({
      enabled: true,
      displayName: "Test KG",
    });

    render(
      <KnowledgeGraphUploadIndicator
        files={[
          { mediaType: "application/octet-stream", filename: "readme.md" },
          { mediaType: "application/octet-stream", filename: "config.yaml" },
        ]}
      />,
    );

    expect(screen.getByText("KG Upload")).toBeInTheDocument();
  });
});
