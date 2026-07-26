import fs from 'fs'
import path from 'path'

const GATE_PATH = path.join(process.cwd(), 'catalog', 'deployment-gate.json')

export function checkDeploymentGate(): { readyForApproval: boolean; blocking: string[] } {
  if (!fs.existsSync(GATE_PATH)) return { readyForApproval: false, blocking: ['catalog belum pernah disinkron'] }
  return JSON.parse(fs.readFileSync(GATE_PATH, 'utf-8'))
}
