from collections import defaultdict
from pathlib import Path


def build_output(title: str, source_relpath: str, body_md: str) -> str:
    """Assemble the final output document.

    Format (Context7-style provenance, no YAML frontmatter):

        # <Title>

        Source: <relative-path>

        <body markdown>
    """
    return f"# {title}\n\nSource: {source_relpath}\n\n{body_md.strip()}\n"


def detect_collisions(
    input_paths: list[Path],
    source_root: Path,
    output_root: Path,
    *,
    case_insensitive_check: bool = False,
) -> dict[Path, Path]:
    """Build the input -> output mapping. Raise ValueError on collisions.

    Each input gets a mirrored output path with `.html`/`.htm` swapped to `.md`.

    If `case_insensitive_check` is True, two distinct inputs that map to the
    same output path under case-insensitive filesystem semantics are flagged.
    Otherwise only exact-string collisions are detected.
    """
    mapping: dict[Path, Path] = {}
    inverse: dict[str, list[Path]] = defaultdict(list)

    for in_path in input_paths:
        rel = in_path.relative_to(source_root)
        out_path = output_root / rel.with_suffix(".md")
        mapping[in_path] = out_path
        key = out_path.as_posix().lower() if case_insensitive_check else out_path.as_posix()
        inverse[key].append(in_path)

    collisions = {k: v for k, v in inverse.items() if len(v) > 1}
    if collisions:
        lines = ["output path collisions detected:"]
        for k, sources in collisions.items():
            lines.append(f"  -> {k}")
            for s in sources:
                lines.append(f"      from {s}")
        raise ValueError("\n".join(lines))

    return mapping


def write_output(out_path: Path, content: str) -> None:
    """Write content to out_path with utf-8 encoding, creating parent dirs."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(content, encoding="utf-8")
