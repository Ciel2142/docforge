import pytest

from docforge.cli import build_parser


def test_parser_requires_source():
    p = build_parser()
    with pytest.raises(SystemExit):
        p.parse_args([])


def test_parser_requires_output():
    p = build_parser()
    with pytest.raises(SystemExit):
        p.parse_args(["src"])


def test_parser_accepts_source_and_output():
    p = build_parser()
    args = p.parse_args(["src", "--output", "out"])
    assert args.source == "src"
    assert args.output == "out"


def test_parser_default_fail_threshold():
    p = build_parser()
    args = p.parse_args(["src", "--output", "out"])
    assert args.fail_threshold == pytest.approx(0.10)


def test_parser_custom_fail_threshold():
    p = build_parser()
    args = p.parse_args(["src", "--output", "out", "--fail-threshold", "0.5"])
    assert args.fail_threshold == pytest.approx(0.5)


def test_parser_default_max_bytes():
    p = build_parser()
    args = p.parse_args(["src", "--output", "out"])
    assert args.max_bytes == 52_428_800


def test_parser_custom_max_bytes():
    p = build_parser()
    args = p.parse_args(["src", "--output", "out", "--max-bytes", "1048576"])
    assert args.max_bytes == 1_048_576


def test_parser_dry_run_flag():
    p = build_parser()
    args = p.parse_args(["src", "--output", "out", "--dry-run"])
    assert args.dry_run is True
    args = p.parse_args(["src", "--output", "out"])
    assert args.dry_run is False


def test_parser_verbose_flag():
    p = build_parser()
    args = p.parse_args(["-v", "src", "--output", "out"])
    assert args.verbose is True


def test_parser_quiet_flag():
    p = build_parser()
    args = p.parse_args(["-q", "src", "--output", "out"])
    assert args.quiet is True


def test_version_flag_exits():
    p = build_parser()
    with pytest.raises(SystemExit) as ei:
        p.parse_args(["--version"])
    assert ei.value.code == 0
