import argparse
import logging
import sys
from pathlib import Path

from . import __version__
from .convert import ConvertStatus, convert_html
from .links import rewrite_internal_links
from .output import build_output, detect_collisions, write_output
from .title import extract_title
from .walk import iter_html_files

log = logging.getLogger("docforge")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="docforge",
        description="Convert documentation HTML to Markdown for RAG ingestion.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  docforge ~/docs/diadok --output ~/docs/diadok-md\n"
            "  docforge page.html --output ./out\n"
            "  docforge ~/docs/some-corpus --output /tmp/out --dry-run -v\n"
        ),
    )
    parser.add_argument("source", help="path to HTML file or directory")
    parser.add_argument("--output", required=True, help="output directory (mirrors source structure)")
    parser.add_argument(
        "--fail-threshold",
        type=float,
        default=0.10,
        help="max acceptable failure ratio before exit 1 (default 0.10; set 1.0 to disable)",
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=52_428_800,
        help="skip HTML files larger than N bytes (default 50MB)",
    )
    parser.add_argument("--dry-run", action="store_true", help="walk + report planned outputs, write nothing")
    verbosity = parser.add_mutually_exclusive_group()
    verbosity.add_argument("-v", "--verbose", action="store_true", help="DEBUG-level logging")
    verbosity.add_argument("-q", "--quiet", action="store_true", help="WARNING-level logging")
    parser.add_argument("--version", action="version", version=f"docforge {__version__}")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose, args.quiet)

    source = Path(args.source).expanduser()
    output = Path(args.output).expanduser()

    if not source.exists():
        log.error("source not found: %s", source)
        return 2
    if not source.is_file() and not source.is_dir():
        log.error("source is neither file nor directory: %s", source)
        return 2

    try:
        output.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        log.error("cannot create output dir %s: %s", output, e)
        return 2

    paths = list(iter_html_files(source, max_bytes=args.max_bytes))
    if not paths:
        log.warning("no HTML files found under %s", source)
        log.info("converted=0  empty=0  skipped=0  failed=0  total=0")
        return 0

    source_root = source.parent if source.is_file() else source

    try:
        mapping = detect_collisions(paths, source_root, output)
    except ValueError as e:
        log.error("%s", e)
        return 2

    converted = empty = failed = 0
    for in_path in paths:
        rel = in_path.relative_to(source_root)
        out_path = mapping[in_path]
        if args.dry_run:
            log.info("DRY %s -> %s", rel.as_posix(), out_path)
            continue

        try:
            raw = in_path.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            log.error("FAIL read %s: %s", rel.as_posix(), e)
            failed += 1
            continue

        result = convert_html(raw)
        if result.status == ConvertStatus.EMPTY:
            empty += 1
            log.debug("empty %s", rel.as_posix())
            continue
        if result.status == ConvertStatus.FAILED:
            failed += 1
            log.error("FAIL %s: %s", rel.as_posix(), result.error)
            continue

        title = extract_title(result.h1_text, result.soup_title_text, in_path.stem)
        body_md = rewrite_internal_links(result.body_md or "")
        content = build_output(title, rel.as_posix(), body_md)
        write_output(out_path, content)
        converted += 1

    skipped = 0  # walker drops non-HTML and oversize files silently in v1; tracking deferred
    total = converted + empty + failed
    log.info(
        "converted=%d  empty=%d  skipped=%d  failed=%d  total=%d",
        converted, empty, skipped, failed, total,
    )

    if total > 0 and (failed / total) > args.fail_threshold:
        log.error(
            "failure ratio %.3f exceeds threshold %.3f",
            failed / total, args.fail_threshold,
        )
        return 1

    return 0


def _configure_logging(verbose: bool, quiet: bool) -> None:
    if verbose:
        level = logging.DEBUG
    elif quiet:
        level = logging.WARNING
    else:
        level = logging.INFO
    logging.basicConfig(
        stream=sys.stderr,
        level=level,
        format="%(levelname)s %(name)s: %(message)s",
        force=True,
    )


if __name__ == "__main__":
    sys.exit(main())
