from pathlib import Path

import pytest

from docforge.walk import iter_html_files


def _touch(p: Path, content: str = "") -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    return p


def test_finds_single_html_file(tmp_path):
    f = _touch(tmp_path / "a.html")
    result = list(iter_html_files(f, max_bytes=10_000))
    assert result == [f]


def test_skips_non_html_extensions(tmp_path):
    _touch(tmp_path / "a.html")
    _touch(tmp_path / "b.css")
    _touch(tmp_path / "c.js")
    _touch(tmp_path / "d.png")
    _touch(tmp_path / "e.txt")
    names = [p.name for p in iter_html_files(tmp_path, max_bytes=10_000)]
    assert names == ["a.html"]


def test_includes_htm_extension(tmp_path):
    _touch(tmp_path / "a.htm")
    names = [p.name for p in iter_html_files(tmp_path, max_bytes=10_000)]
    assert names == ["a.htm"]


def test_skips_named_files(tmp_path):
    _touch(tmp_path / "page.html")
    _touch(tmp_path / "genindex.html")
    _touch(tmp_path / "search.html")
    names = [p.name for p in iter_html_files(tmp_path, max_bytes=10_000)]
    assert names == ["page.html"]


def test_skips_static_and_downloads_dirs(tmp_path):
    _touch(tmp_path / "page.html")
    _touch(tmp_path / "_static" / "asset.html")
    _touch(tmp_path / "_downloads" / "dl.html")
    names = sorted(p.name for p in iter_html_files(tmp_path, max_bytes=10_000))
    assert names == ["page.html"]


def test_skips_dot_dirs(tmp_path):
    _touch(tmp_path / "page.html")
    _touch(tmp_path / ".git" / "hidden.html")
    _touch(tmp_path / ".venv" / "lib.html")
    _touch(tmp_path / ".tox" / "x.html")
    names = sorted(p.name for p in iter_html_files(tmp_path, max_bytes=10_000))
    assert names == ["page.html"]


def test_skips_node_modules_and_pycache(tmp_path):
    _touch(tmp_path / "page.html")
    _touch(tmp_path / "node_modules" / "x.html")
    _touch(tmp_path / "__pycache__" / "x.html")
    _touch(tmp_path / "dist" / "x.html")
    _touch(tmp_path / "build" / "x.html")
    names = sorted(p.name for p in iter_html_files(tmp_path, max_bytes=10_000))
    assert names == ["page.html"]


def test_recursive_walk(tmp_path):
    _touch(tmp_path / "top.html")
    _touch(tmp_path / "sub" / "mid.html")
    _touch(tmp_path / "sub" / "deeper" / "leaf.html")
    paths = list(iter_html_files(tmp_path, max_bytes=10_000))
    rels = sorted(p.relative_to(tmp_path).as_posix() for p in paths)
    assert rels == ["sub/deeper/leaf.html", "sub/mid.html", "top.html"]


def test_sorted_iteration_within_directory(tmp_path):
    _touch(tmp_path / "c.html")
    _touch(tmp_path / "a.html")
    _touch(tmp_path / "b.html")
    names = [p.name for p in iter_html_files(tmp_path, max_bytes=10_000)]
    assert names == ["a.html", "b.html", "c.html"]


def test_does_not_follow_symlinks(tmp_path):
    real = _touch(tmp_path / "real.html")
    link = tmp_path / "link.html"
    link.symlink_to(real)
    names = [p.name for p in iter_html_files(tmp_path, max_bytes=10_000)]
    assert names == ["real.html"]


def test_does_not_follow_symlink_dirs(tmp_path):
    real_dir = tmp_path / "real"
    _touch(real_dir / "inside.html")
    link_dir = tmp_path / "link_dir"
    link_dir.symlink_to(real_dir, target_is_directory=True)
    names = [p.relative_to(tmp_path).as_posix() for p in iter_html_files(tmp_path, max_bytes=10_000)]
    assert names == ["real/inside.html"]


def test_skips_files_above_max_bytes(tmp_path, caplog):
    big = _touch(tmp_path / "big.html", content="x" * 5_000)
    small = _touch(tmp_path / "small.html", content="ok")
    with caplog.at_level("WARNING", logger="docforge.walk"):
        names = [p.name for p in iter_html_files(tmp_path, max_bytes=1_000)]
    assert names == ["small.html"]
    assert any("big.html" in rec.message for rec in caplog.records)
