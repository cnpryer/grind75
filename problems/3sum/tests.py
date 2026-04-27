from solution import three_sum


def _normalize(triplets: list[list[int]]) -> list[tuple[int, ...]]:
    return sorted(tuple(sorted(t)) for t in triplets)


def test_example_1():
    assert _normalize(three_sum([-1, 0, 1, 2, -1, -4])) == [(-1, -1, 2), (-1, 0, 1)]


def test_no_triplets():
    assert three_sum([0, 1, 1]) == []


def test_all_zeros():
    assert _normalize(three_sum([0, 0, 0])) == [(0, 0, 0)]


def test_many_zeros_dedup():
    assert _normalize(three_sum([0, 0, 0, 0])) == [(0, 0, 0)]


def test_all_positive():
    assert three_sum([1, 2, 3, 4, 5]) == []


def test_all_negative():
    assert three_sum([-5, -4, -3, -2, -1]) == []


def test_with_duplicates():
    assert _normalize(three_sum([-2, 0, 0, 2, 2])) == [(-2, 0, 2)]


def test_minimum_length():
    assert _normalize(three_sum([-1, 0, 1])) == [(-1, 0, 1)]


def test_minimum_length_no_match():
    assert three_sum([1, 2, 3]) == []


def test_mixed_with_multiple_triplets():
    assert _normalize(three_sum([-2, -1, -1, 0, 1, 2, 2])) == [
        (-2, 0, 2),
        (-1, -1, 2),
        (-1, 0, 1),
    ]
