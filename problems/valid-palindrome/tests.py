from solution import is_palindrome


def test_classic_phrase():
    assert is_palindrome("A man, a plan, a canal: Panama") is True


def test_non_palindrome_phrase():
    assert is_palindrome("race a car") is False


def test_blank_cleaned_is_palindrome():
    assert is_palindrome(" ") is True


def test_empty_string_is_palindrome():
    assert is_palindrome("") is True


def test_mixed_case():
    assert is_palindrome("RaceCar") is True


def test_digits_count_as_alphanumeric():
    assert is_palindrome("12!!21") is True


def test_symbols_only_is_palindrome():
    # Everything gets stripped → empty cleaned string is a palindrome.
    assert is_palindrome("!@#$%") is True


def test_off_by_one_mismatch():
    assert is_palindrome("ab") is False
