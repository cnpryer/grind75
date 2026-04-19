def flood_fill(image: list[list[int]], sr: int, sc: int, color: int) -> list[list[int]]:
    source = image[sr][sc]
    if source == color:
        return image

    rows, cols = len(image), len(image[0])
    stack: list[tuple[int, int]] = [(sr, sc)]
    while stack:
        r, c = stack.pop()
        if image[r][c] != source:
            continue
        image[r][c] = color
        if r > 0:
            stack.append((r - 1, c))
        if r + 1 < rows:
            stack.append((r + 1, c))
        if c > 0:
            stack.append((r, c - 1))
        if c + 1 < cols:
            stack.append((r, c + 1))
    return image
