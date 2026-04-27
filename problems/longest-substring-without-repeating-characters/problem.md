# Longest Substring Without Repeating Characters

Given a string `s`, return the length of the longest substring that contains no
repeating characters.

A substring is a contiguous slice of `s` — order matters and the characters
must be adjacent in the original string.

## Examples

```
Input:  s = "abcabcbb"
Output: 3
Explanation: "abc" has length 3.
```

```
Input:  s = "bbbbb"
Output: 1
Explanation: "b".
```

```
Input:  s = "pwwkew"
Output: 3
Explanation: "wke". Note that "pwke" is a subsequence, not a substring.
```

## Constraints

- `0 <= len(s) <= 50_000`
- `s` consists of English letters, digits, symbols, and spaces.

## Hints

- A sliding window over `s` only needs to grow on the right and shrink on the left.
- Track the last index you saw each character. When you see a repeat inside the
  window, jump the left edge past that previous index.
- The answer is the largest `right - left + 1` you observe.
