from solution import is_anagram


def test_classic_anagram():
    assert is_anagram("anagram", "nagaram") is True


def test_different_letters():
    assert is_anagram("rat", "car") is False


def test_both_empty():
    assert is_anagram("", "") is True


def test_different_lengths():
    assert is_anagram("a", "ab") is False


def test_same_letters_different_counts():
    # Same alphabet, same length, different multiplicities.
    assert is_anagram("aabb", "abbb") is False


def test_single_letter_match():
    assert is_anagram("x", "x") is True


def test_palindromic_anagram():
    assert is_anagram("abcba", "bacba") is True
