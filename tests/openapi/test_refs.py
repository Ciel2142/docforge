import pytest

from docforge.openapi.refs import (
    ref_link,
    ref_to_schema_name,
)


def test_ref_to_schema_name_simple() -> None:
    assert ref_to_schema_name("#/components/schemas/Pet") == "Pet"


def test_ref_to_schema_name_nested_name() -> None:
    assert ref_to_schema_name("#/components/schemas/Foo.Bar") == "Foo.Bar"


def test_ref_to_schema_name_returns_none_for_non_schema_ref() -> None:
    assert ref_to_schema_name("#/components/responses/Default") is None
    assert ref_to_schema_name("#/paths/~1pets/get") is None
    assert ref_to_schema_name("not-a-ref") is None


def test_ref_link_from_endpoint() -> None:
    assert ref_link("#/components/schemas/Pet", from_kind="endpoint") == (
        "Pet",
        "../schemas/Pet.md",
    )


def test_ref_link_from_schema() -> None:
    assert ref_link("#/components/schemas/Pet", from_kind="schema") == (
        "Pet",
        "Pet.md",
    )


def test_ref_link_unknown_ref_returns_raw() -> None:
    label, href = ref_link("#/components/responses/Default", from_kind="endpoint")
    assert label == "#/components/responses/Default"
    assert href == "#/components/responses/Default"


def test_ref_link_invalid_from_kind() -> None:
    with pytest.raises(ValueError, match="from_kind"):
        ref_link("#/components/schemas/Pet", from_kind="bogus")
