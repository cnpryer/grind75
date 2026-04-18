# Valid Anagram

Given two strings `s` and `t`, return `True` if `t` is an anagram of `s` and
`False` otherwise.

An **anagram** is a rearrangement of the letters of another word using every
letter exactly once.

## Examples

```
Input:  s = "anagram", t = "nagaram"
Output: True
```

```
Input:  s = "rat", t = "car"
Output: False
```

```
Input:  s = "", t = ""
Output: True
```

## Constraints

- `0 <= len(s), len(t) <= 50_000`
- `s` and `t` contain lowercase English letters only.

## Hints

- If the two strings differ in length they cannot be anagrams.
- A frequency counter over `s` minus one over `t` must be the zero map.
- `sorted(s) == sorted(t)` works in `O(n log n)` — the counter version is `O(n)`.
