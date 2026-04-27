def length_of_longest_substring(s: str) -> int:
    last: dict[str, int] = {}
    left = 0
    best = 0
    for right, ch in enumerate(s):
        prev = last.get(ch)
        if prev is not None and prev >= left:
            left = prev + 1
        last[ch] = right
        if right - left + 1 > best:
            best = right - left + 1
    return best
