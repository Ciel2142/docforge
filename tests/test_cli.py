import subprocess
import sys
import textwrap
from pathlib import Path

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


def _run_cli(*args, cwd=None):
    """Invoke the cli via `python -m docforge` so coverage and import paths work."""
    cmd = [sys.executable, "-m", "docforge", *args]
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def _make_sphinx_html(title: str, body_html: str) -> str:
    return textwrap.dedent(f"""\
        <html>
        <head><title>{title}</title></head>
        <body>
          <div role="main">
            <div itemprop="articleBody">
              {body_html}
            </div>
          </div>
        </body>
        </html>
        """)


def _seed_tree(root: Path) -> None:
    (root / "page1.html").write_text(_make_sphinx_html("Page 1", "<h1>Page 1</h1><p>Hello.</p>"), encoding="utf-8")
    (root / "sub").mkdir()
    (root / "sub" / "page2.html").write_text(
        _make_sphinx_html("Page 2", '<h1>Page 2</h1><p>See <a href="../page1.html">first</a>.</p>'),
        encoding="utf-8",
    )
    (root / "asset.css").write_text("body{}", encoding="utf-8")
    (root / "empty.html").write_text("<html><body><p>no body marker</p></body></html>", encoding="utf-8")


def test_e2e_converts_tree(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    _seed_tree(src)
    out = tmp_path / "out"

    r = _run_cli(str(src), "--output", str(out))
    assert r.returncode == 0, r.stderr

    p1 = (out / "page1.md").read_text(encoding="utf-8")
    p2 = (out / "sub" / "page2.md").read_text(encoding="utf-8")

    assert p1.startswith("# Page 1\n\nSource: page1.html\n\n")
    assert "Hello." in p1
    assert p2.startswith("# Page 2\n\nSource: sub/page2.html\n\n")
    assert "(../page1.md)" in p2 or "../page1.md" in p2
    assert not (out / "asset.css.md").exists()
    assert not (out / "empty.md").exists()


def test_e2e_dry_run_writes_nothing(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    _seed_tree(src)
    out = tmp_path / "out"

    r = _run_cli(str(src), "--output", str(out), "--dry-run", "-v")
    assert r.returncode == 0, r.stderr
    assert not any(out.rglob("*.md"))


def test_e2e_idempotent_rerun(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    _seed_tree(src)
    out = tmp_path / "out"

    r1 = _run_cli(str(src), "--output", str(out))
    assert r1.returncode == 0
    body1 = (out / "page1.md").read_text(encoding="utf-8")

    r2 = _run_cli(str(src), "--output", str(out))
    assert r2.returncode == 0
    body2 = (out / "page1.md").read_text(encoding="utf-8")

    assert body1 == body2


def test_e2e_missing_source_exits_2(tmp_path):
    r = _run_cli(str(tmp_path / "nope"), "--output", str(tmp_path / "out"))
    assert r.returncode == 2
    assert "source not found" in r.stderr.lower() or "not found" in r.stderr.lower()


def test_e2e_threshold_breached_exits_1(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "good.html").write_text(
        _make_sphinx_html("Good", "<h1>Good</h1><p>x</p>"),
        encoding="utf-8",
    )
    out = tmp_path / "out"

    wrapper = tmp_path / "wrapper.py"
    wrapper.write_text(textwrap.dedent("""\
        import sys
        import docforge.convert as c
        def boom(*a, **kw):
            raise RuntimeError("forced failure")
        c.html_to_markdown.convert = boom
        from docforge.cli import main
        sys.exit(main())
        """), encoding="utf-8")

    r = subprocess.run(
        [sys.executable, str(wrapper), str(src), "--output", str(out)],
        capture_output=True, text=True,
    )
    assert r.returncode == 1, f"stdout={r.stdout!r} stderr={r.stderr!r}"


def test_e2e_collision_exits_2(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "page.html").write_text(_make_sphinx_html("X", "<h1>X</h1>"), encoding="utf-8")
    (src / "page.htm").write_text(_make_sphinx_html("X", "<h1>X</h1>"), encoding="utf-8")
    out = tmp_path / "out"

    r = _run_cli(str(src), "--output", str(out))
    assert r.returncode == 2
    assert "collision" in r.stderr.lower()


def test_e2e_help_lists_all_flags():
    r = _run_cli("--help")
    assert r.returncode == 0
    for flag in ("--output", "--fail-threshold", "--max-bytes", "--dry-run", "--version"):
        assert flag in r.stdout, f"missing {flag} in --help output"


def test_e2e_version_flag_prints_and_exits():
    r = _run_cli("--version")
    assert r.returncode == 0
    assert "docforge" in r.stdout


def test_e2e_summary_line_includes_skipped_per_spec(tmp_path):
    """Spec §7 line 148 mandates `converted=N  empty=M  skipped=K  failed=F  total=T`."""
    src = tmp_path / "src"
    src.mkdir()
    _seed_tree(src)
    out = tmp_path / "out"

    r = _run_cli(str(src), "--output", str(out))
    assert r.returncode == 0, r.stderr
    for key in ("converted=", "empty=", "skipped=", "failed=", "total="):
        assert key in r.stderr, f"missing {key} in summary; stderr=\n{r.stderr}"
