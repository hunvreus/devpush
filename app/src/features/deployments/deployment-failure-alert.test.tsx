import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { DeploymentFailureAlert } from './deployment-detail'

describe('deployment failure alert', () => {
  test('shows the recorded reason for a failed deployment', () => {
    const html = renderToStaticMarkup(
      <DeploymentFailureAlert
        deployment={{
          status: 'failed',
          errorMessage: 'Workspace is restricted.',
        }}
      />,
    )
    expect(html).toContain('Deployment failed')
    expect(html).toContain('Workspace is restricted.')
  })

  test('uses a fallback when no reason is available and hides for other statuses', () => {
    expect(
      renderToStaticMarkup(
        <DeploymentFailureAlert
          deployment={{ status: 'failed', errorMessage: null }}
        />,
      ),
    ).toContain('The deployment could not be completed.')
    expect(
      renderToStaticMarkup(
        <DeploymentFailureAlert
          deployment={{ status: 'queued', errorMessage: null }}
        />,
      ),
    ).toBe('')
  })
})
