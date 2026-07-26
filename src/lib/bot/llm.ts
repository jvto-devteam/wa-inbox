async function callOllama(prompt: string): Promise<string> {
  const res = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
    method: 'POST',
    body: JSON.stringify({ model: 'llama3', prompt, stream: false }),
  })
  if (!res.ok) throw new Error('Ollama request failed')
  const body = await res.json()
  return body.response
}

async function callOpenAI(prompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) throw new Error('OpenAI request failed')
  const body = await res.json()
  return body.choices[0].message.content
}

export async function callLLM(prompt: string, opts?: { forceLocal?: boolean }): Promise<string> {
  if (opts?.forceLocal) return callOllama(prompt)
  try {
    return await callOpenAI(prompt)
  } catch {
    return callOllama(prompt)
  }
}
