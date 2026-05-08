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
