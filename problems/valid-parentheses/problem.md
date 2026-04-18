# Valid Parentheses

Given a string `s` containing only the characters `(`, `)`, `{`, `}`, `[`, `]`,
determine whether the brackets are balanced.

A string is balanced when every opening bracket has a matching closing
bracket of the same type, and the pairs are properly nested.

## Examples

```
Input:  "()"
Output: True
```

```
Input:  "()[]{}"
Output: True
```

```
Input:  "(]"
Output: False
```

```
Input:  "([)]"
Output: False
```

```
Input:  "{[]}"
Output: True
```

## Constraints

- `0 <= len(s) <= 10_000`
- `s` contains only `()[]{}`.

## Hints

- A stack is a natural fit: push every opener, pop-and-match on every closer.
- A mismatched or empty-stack pop means the string is unbalanced.
- Don't forget to check that the stack is empty at the end.
