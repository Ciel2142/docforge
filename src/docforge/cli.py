import argparse
import sys

from . import __version__


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="docforge", description="Convert documentation HTML to Markdown.")
    parser.add_argument("--version", action="version", version=f"docforge {__version__}")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    parser.parse_args(argv)
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
