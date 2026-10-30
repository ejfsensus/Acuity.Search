/**
 * Incremental parser for the Agent's AI SDK UI-message stream
 * (`data: {json}\n\n` … `data: [DONE]`).
 */
export interface AgentChunk {
  type: string
  [key: string]: unknown
}

export class UiStreamParser {
  private buffer = ''
  done = false

  /** Feeds raw text; returns the complete chunks it contained. */
  push(text: string): AgentChunk[] {
    this.buffer += text.replace(/\r\n/g, '\n')
    const out: AgentChunk[] = []
    let index: number
    while ((index = this.buffer.indexOf('\n\n')) >= 0) {
      const event = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 2)
      const data = event
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, ''))
        .join('\n')
      if (!data) continue
      if (data === '[DONE]') {
        this.done = true
        continue
      }
      try {
        const parsed = JSON.parse(data)
        if (parsed && typeof parsed.type === 'string') out.push(parsed)
      } catch {
        // ignore malformed lines
      }
    }
    return out
  }

  /** Flushes a trailing event without the final blank line. */
  end(): AgentChunk[] {
    return this.buffer.trim() ? this.push('\n\n') : []
  }
}
