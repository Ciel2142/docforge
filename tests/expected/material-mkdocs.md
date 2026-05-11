## Quickstart



Install Kreuzberg with pip. This installs the core library only; document type backends are optional extras you can add as needed.



## Installation



```bash
pip install kreuzberg
```


## Basic usage



Pass a file path or bytes buffer to `extract_file` and receive an `ExtractionResult` back. The result contains the extracted text plus metadata such as page count and detected language.
