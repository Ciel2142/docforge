from docforge.convert import ConvertResult, ConvertStatus


def test_status_enum_has_three_values():
    assert {s.name for s in ConvertStatus} == {"OK", "EMPTY", "FAILED"}


def test_default_result_fields_are_none():
    r = ConvertResult(status=ConvertStatus.EMPTY)
    assert r.body_md is None
    assert r.h1_text is None
    assert r.soup_title_text is None
    assert r.error is None
