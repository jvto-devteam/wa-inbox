import { NextResponse } from 'next/server'
import { checkDeploymentGate } from '@/lib/bot/deployment-gate'

export async function GET() {
  return NextResponse.json(checkDeploymentGate())
}
