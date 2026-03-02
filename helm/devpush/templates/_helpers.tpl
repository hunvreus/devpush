{{- define "devpush.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "devpush.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "devpush.labels" -}}
app.kubernetes.io/name: {{ include "devpush.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "devpush.selectorLabels" -}}
app.kubernetes.io/name: {{ include "devpush.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "devpush.pg.host" -}}
{{- printf "%s-pgsql" (include "devpush.fullname" .) -}}
{{- end -}}

{{- define "devpush.redis.host" -}}
{{- printf "%s-redis" (include "devpush.fullname" .) -}}
{{- end -}}

{{- define "devpush.envSecretName" -}}
{{- if .Values.env.existingSecretName -}}
{{- .Values.env.existingSecretName -}}
{{- else -}}
{{- printf "%s-env" (include "devpush.fullname" .) -}}
{{- end -}}
{{- end -}}
