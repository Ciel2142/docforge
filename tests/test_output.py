from pathlib import Path

import pytest

from docforge.output import build_output, detect_collisions, write_output


def test_build_output_basic():
    out = build_output("My Title", "dir/page.html", "Body content here.")
    assert out == (
        "# My Title\n"
        "\n"
        "Source: dir/page.html\n"
        "\n"
        "Body content here.\n"
    )


def test_build_output_strips_trailing_whitespace_in_body():
    out = build_output("T", "p.html", "  Body.  \n\n  ")
    assert out == "# T\n\nSource: p.html\n\nBody.\n"


def test_build_output_keeps_internal_blank_lines_in_body():
    out = build_output("T", "p.html", "Para 1.\n\nPara 2.")
    assert "Para 1.\n\nPara 2." in out


def test_build_output_handles_unicode_title():
    out = build_output("Заголовок", "ru.html", "Текст")
    assert out.startswith("# Заголовок\n")


def test_detect_collisions_returns_empty_when_unique(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    a = src / "a.html"; a.touch()
    b = src / "sub" / "b.html"; b.parent.mkdir(); b.touch()
    out = tmp_path / "out"
    mapping = detect_collisions([a, b], src, out)
    assert mapping[a] == out / "a.md"
    assert mapping[b] == out / "sub/b.md"


def test_detect_collisions_raises_on_duplicate_output(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    foo_upper = src / "Foo.html"; foo_upper.touch()
    foo_lower = src / "foo.html"; foo_lower.touch()
    out = tmp_path / "out"
    with pytest.raises(ValueError) as ei:
        detect_collisions([foo_upper, foo_lower], src, out, case_insensitive_check=True)
    msg = str(ei.value)
    assert "Foo.html" in msg
    assert "foo.html" in msg
