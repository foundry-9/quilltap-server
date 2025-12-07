# Feature: Artifacts

**Status:** Not Implemented
**Target Version:** TBD

## Summary

Display renderable content (Markdown, HTML, code) in a side panel, similar to how Claude.ai displays artifacts.

## Requirements

- Detect renderable content in LLM responses (Markdown, HTML, code blocks, etc.)
- Display in a right-side panel, shifting chat to the left (similar to Chat Debug screen layout)
- Hover actions:
  - **Copy** - Copy artifact content to clipboard
  - **Download** - Download as appropriate file type

## Implementation Notes

- Could leverage existing Chat Debug panel layout pattern
- Consider auto-detection vs explicit artifact markers
- Support multiple artifact types (text, code, diagrams, etc.)
