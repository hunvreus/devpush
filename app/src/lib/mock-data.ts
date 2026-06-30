export const team = {
  name: 'Ronan Berder',
  slug: 'ronan-berder',
  initial: 'R',
  color: 'lime' as const,
}

export const currentUser = {
  name: 'Ronan Berder',
  email: 'hunvreus@gmail.com',
}

export const projects = [
  {
    name: 'flask-basics',
    slug: 'flask-basics',
    initial: 'F',
    color: 'sky' as const,
    repo: 'hunvreus/flask-basics',
    domain: 'flask-basics.devpush.app',
    server: 'hetzner-fsn1',
  },
]

export const project = projects[0]

export const repositories = [
  { name: 'basecoat', owner: 'hunvreus', updatedAt: '20 hours ago' },
  { name: 'flask-basics', owner: 'hunvreus', updatedAt: '2 days ago' },
  { name: 'pagescms', owner: 'hunvreus', updatedAt: '4 days ago' },
  { name: 'starshot', owner: 'hunvreus', updatedAt: '1 week ago' },
  { name: 'skill-issue', owner: 'hunvreus', updatedAt: '2 weeks ago' },
]

export const deployments = [
  {
    id: '43ba6c58ff9a127de5103b3f6357b6f6',
    sha: '43ba6c5',
    status: 'succeeded',
    environment: 'Production',
    branch: 'main',
    message: 'Formatting',
    age: '3 months ago',
    current: true,
  },
  {
    id: 'd000f77',
    sha: 'd000f77',
    status: 'failed',
    environment: 'Production',
    branch: 'main',
    message: 'Formatting',
    age: '3 months ago',
    current: false,
  },
  {
    id: '6700e36',
    sha: '6700e36',
    status: 'succeeded',
    environment: 'Production',
    branch: 'main',
    message: 'Formatting',
    age: '3 months ago',
    current: false,
    previous: true,
  },
  {
    id: '425884a',
    sha: '425884a',
    status: 'succeeded',
    environment: 'Production',
    branch: 'main',
    message: 'Formatting',
    age: '3 months ago',
    current: false,
  },
]

export const deploymentLogs = [
  'Queued deployment 43ba6c5 for Production',
  'Agent hetzner-fsn1 accepted job',
  'Fetched hunvreus/flask-basics at 43ba6c5',
  'Resolved compose.yml',
  'Built service web',
  'Release command completed',
  'Readiness check passed for web:3000',
  'Switched traffic to revision 43ba6c5',
]
