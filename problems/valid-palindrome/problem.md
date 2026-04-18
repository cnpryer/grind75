# Valid Palindrome

A phrase is a **palindrome** if, after lowercasing and removing every
non-alphanumeric character, it reads the same forward and backward.

Given a string `s`, return `True` if it is a palindrome and `False` otherwise.

## Examples

```
Input:  "A man, a plan, a canal: Panama"
Output: True
Explanation: "amanaplanacanalpanama"
```

```
Input:  "race a car"
Output: False
Explanation: "raceacar" is not a palindrome.
```

```
Input:  " "
Output: True
Explanation: An empty cleaned string is trivially a palindrome.
```

## Constraints

- `0 <= len(s) <= 200_000`
- `s` consists of printable ASCII characters.

## Hints

- Two pointers at the ends, walking toward the middle.
- Skip characters that aren't letters/digits (`str.isalnum()`).
- Compare case-insensitively.
