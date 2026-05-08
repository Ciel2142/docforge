from docforge.title import extract_title


def test_h1_takes_priority():
    assert extract_title("Body Heading", "Page Title", "stem") == "Body Heading"


def test_soup_title_when_no_h1():
    assert extract_title(None, "Page Title", "stem") == "Page Title"


def test_stem_when_no_h1_and_no_title():
    assert extract_title(None, None, "stem") == "stem"


def test_empty_h1_falls_through():
    assert extract_title("", "Page Title", "stem") == "Page Title"


def test_empty_soup_title_falls_through_to_stem():
    assert extract_title(None, "", "stem") == "stem"


def test_whitespace_only_h1_falls_through():
    assert extract_title("   ", "Page Title", "stem") == "Page Title"
