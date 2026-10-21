import { defineServerDeployment, deploymentApiVersion } from './contract'

export default defineServerDeployment({
  apiVersion: deploymentApiVersion,
  name: 'devpush-oss',
  create: () => ({}),
})
