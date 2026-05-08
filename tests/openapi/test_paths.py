import pytest

from docforge.openapi.paths import (
    SlugCollisionError,
    detect_endpoint_collisions,
    endpoint_filename,
    schema_filename,
    slug_path,
)


def test_slug_path_simple() -> None:
    assert slug_path("/pets") == "pets"


def test_slug_path_nested() -> None:
    assert slug_path("/V3/Authenticate") == "V3_Authenticate"


def test_slug_path_with_brace_param() -> None:
    assert slug_path("/pets/{id}") == "pets_id"


def test_slug_path_collapses_repeated_underscores() -> None:
    assert slug_path("/a//b/{x}/{y}") == "a_b_x_y"


def test_slug_path_root() -> None:
    assert slug_path("/") == "root"


def test_endpoint_filename() -> None:
    assert endpoint_filename("get", "/pets") == "GET_pets.md"
    assert endpoint_filename("POST", "/V3/Authenticate") == "POST_V3_Authenticate.md"
    assert endpoint_filename("get", "/pets/{id}") == "GET_pets_id.md"


def test_schema_filename_passthrough() -> None:
    assert schema_filename("Pet") == "Pet.md"
    assert schema_filename("Foo.Bar") == "Foo.Bar.md"


def test_detect_endpoint_collisions_clean() -> None:
    pairs = [("get", "/pets"), ("post", "/pets"), ("get", "/pets/{id}")]
    detect_endpoint_collisions(pairs)


def test_detect_endpoint_collisions_raises() -> None:
    pairs = [("get", "/pets/{id}"), ("get", "/pets/id")]
    with pytest.raises(SlugCollisionError, match="GET_pets_id.md"):
        detect_endpoint_collisions(pairs)
