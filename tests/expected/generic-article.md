## API Reference



The API exposes three primary entry points: `extract_file`, `extract_bytes`, and `batch_extract_file`. All accept the same options object and return identical result shapes.



## extract_file



Synchronously extract content from a file path on disk. The function reads the file, sniffs the MIME type, and dispatches to the appropriate backend.
