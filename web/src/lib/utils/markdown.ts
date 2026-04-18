import DOMPurify from 'dompurify'
import { marked } from 'marked'

/**
 * Render trusted (authored) markdown to a sanitized HTML string. `marked`
 * already escapes raw HTML by default, and DOMPurify strips anything that
 * slips through or that we add via an extension later. Trusted because the
 * input is authored problem content, not user-submitted text.
 */
export async function renderMarkdown(md: string): Promise<string> {
	const html = await marked.parse(md, { async: true, breaks: false, gfm: true })
	return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}
