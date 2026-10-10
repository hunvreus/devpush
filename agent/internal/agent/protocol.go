package agent

type agentRequest struct {
	ServerID        string           `json:"serverId,omitempty"`
	Token           string           `json:"token"`
	AgentVersion    string           `json:"agentVersion"`
	ProtocolVersion int              `json:"protocolVersion"`
	Capabilities    []string         `json:"capabilities"`
	RuntimeIDs      []string         `json:"runtimeIds,omitempty"`
	Runtimes        []composeRuntime `json:"runtimes,omitempty"`
	System          *hostDetails     `json:"system,omitempty"`
	MetricSamples   []metricSample   `json:"metricSamples,omitempty"`
}

type hostDetails struct {
	Hostname        string  `json:"hostname,omitempty"`
	OperatingSystem string  `json:"operatingSystem,omitempty"`
	KernelVersion   string  `json:"kernelVersion,omitempty"`
	Architecture    string  `json:"architecture,omitempty"`
	CPUCoreCount    int     `json:"cpuCoreCount,omitempty"`
	UptimeSeconds   *uint64 `json:"uptimeSeconds,omitempty"`
}

type composeRuntime struct {
	RuntimeID string           `json:"runtimeId"`
	Services  []composeService `json:"services"`
}

type composeService struct {
	Name          string  `json:"name"`
	ContainerName string  `json:"containerName"`
	State         string  `json:"state"`
	Health        *string `json:"health"`
	RestartCount  int     `json:"restartCount"`
	StartedAt     *string `json:"startedAt"`
	ExitCode      int     `json:"exitCode"`
}

type hostMetrics struct {
	CPUPercent                    *float64 `json:"cpuPercent,omitempty"`
	MemoryUsedBytes               *uint64  `json:"memoryUsedBytes,omitempty"`
	MemoryTotalBytes              *uint64  `json:"memoryTotalBytes,omitempty"`
	DiskUsedBytes                 *uint64  `json:"diskUsedBytes,omitempty"`
	DiskTotalBytes                *uint64  `json:"diskTotalBytes,omitempty"`
	NetworkReceiveBytesPerSecond  *float64 `json:"networkReceiveBytesPerSecond,omitempty"`
	NetworkTransmitBytesPerSecond *float64 `json:"networkTransmitBytesPerSecond,omitempty"`
	DiskReadBytesPerSecond        *float64 `json:"diskReadBytesPerSecond,omitempty"`
	DiskWriteBytesPerSecond       *float64 `json:"diskWriteBytesPerSecond,omitempty"`
}

func (metrics hostMetrics) hasValues() bool {
	return metrics.CPUPercent != nil ||
		metrics.MemoryUsedBytes != nil ||
		metrics.MemoryTotalBytes != nil ||
		metrics.DiskUsedBytes != nil ||
		metrics.DiskTotalBytes != nil ||
		metrics.NetworkReceiveBytesPerSecond != nil ||
		metrics.NetworkTransmitBytesPerSecond != nil ||
		metrics.DiskReadBytesPerSecond != nil ||
		metrics.DiskWriteBytesPerSecond != nil
}

type agentResponse struct {
	MetricsAcceptedThrough string             `json:"metricsAcceptedThrough,omitempty"`
	ServerID               string             `json:"serverId"`
	Status                 string             `json:"status"`
	Credential             string             `json:"credential,omitempty"`
	RuntimeLogTargets      []runtimeLogTarget `json:"runtimeLogTargets"`
}

type runtimeLogTarget struct {
	RuntimeID string `json:"runtimeId"`
}

type runtimeLogsRequest struct {
	ServerID string           `json:"serverId"`
	Token    string           `json:"token"`
	Logs     []runtimeLogLine `json:"logs"`
}

type runtimeLogLine struct {
	RuntimeID  string `json:"runtimeId"`
	Service    string `json:"service"`
	ObservedAt string `json:"observedAt"`
	Content    string `json:"content"`
}

type runtimeLogsResponse struct {
	OK       bool `json:"ok"`
	Accepted int  `json:"accepted"`
	Inserted int  `json:"inserted"`
}

type nextJobResponse struct {
	Job *agentJob `json:"job"`
}

type agentJob struct {
	Type        string        `json:"type"`
	ID          string        `json:"id"`
	LogStartSeq int           `json:"logStartSeq"`
	Repo        repo          `json:"repo"`
	Project     projectConfig `json:"project"`
	Runtime     runtimeConfig `json:"runtime"`
	EnvVars     []envVar      `json:"envVars"`
	Routes      []route       `json:"routes"`
	Cleanup     cleanupConfig `json:"cleanup"`
	Backup      backupConfig  `json:"backup"`
	Restore     restoreConfig `json:"restore"`
}

type deploymentJob struct {
	ID          string        `json:"id"`
	LogStartSeq int           `json:"logStartSeq"`
	Repo        repo          `json:"repo"`
	Project     projectConfig `json:"project"`
	Runtime     runtimeConfig `json:"runtime"`
	EnvVars     []envVar      `json:"envVars"`
	Routes      []route       `json:"routes"`
}

func (job agentJob) deploymentJob() deploymentJob {
	return deploymentJob{
		ID:          job.ID,
		LogStartSeq: job.LogStartSeq,
		Repo:        job.Repo,
		Project:     job.Project,
		Runtime:     job.Runtime,
		EnvVars:     job.EnvVars,
		Routes:      job.Routes,
	}
}

type projectConfig struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type repo struct {
	FullName string `json:"fullName"`
	Branch   string `json:"branch"`
	Sha      string `json:"sha"`
	Token    string `json:"token"`
}

type runtimeConfig struct {
	Type            string `json:"type"`
	Path            string `json:"path"`
	ProjectName     string `json:"projectName"`
	Action          string `json:"action"`
	ReleaseCommand  string `json:"releaseCommand"`
	ReleaseService  string `json:"releaseService"`
	ReadinessPath   string `json:"readinessPath"`
	DeployCommand   string `json:"deployCommand"`
	RollbackCommand string `json:"rollbackCommand"`
	TimeoutSeconds  int    `json:"timeoutSeconds"`
}

type envVar struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type route struct {
	Host        string `json:"host"`
	Service     string `json:"service"`
	Port        int    `json:"port"`
	Path        string `json:"path"`
	HTTPS       bool   `json:"https"`
	StripPrefix bool   `json:"stripPrefix"`
}

type cleanupConfig struct {
	RuntimeIDs       []string          `json:"runtimeIds"`
	RemoveVolumes    bool              `json:"removeVolumes"`
	Reason           string            `json:"reason"`
	BackupRunIDs     []string          `json:"backupRunIds"`
	Destination      backupDestination `json:"destination"`
	LocalObjectKeys  []string          `json:"localObjectKeys"`
	RemoteObjectKeys []string          `json:"remoteObjectKeys"`
}

type backupConfig struct {
	SchemaVersion  int                   `json:"schemaVersion"`
	BackupRunID    string                `json:"backupRunId"`
	ArtifactPrefix string                `json:"artifactPrefix"`
	LocalBasePath  string                `json:"localBasePath"`
	ProjectID      string                `json:"projectId"`
	EnvironmentID  string                `json:"environmentId"`
	RuntimeID      string                `json:"runtimeId"`
	Destination    backupDestination     `json:"destination"`
	Retention      backupRetentionPolicy `json:"retention"`
	Volumes        backupVolumeSelection `json:"volumes"`
	DatabaseDumps  []backupDatabaseDump  `json:"databaseDumps"`
}

type backupDestination struct {
	Bucket          string `json:"bucket"`
	Region          string `json:"region"`
	Endpoint        string `json:"endpoint"`
	Prefix          string `json:"prefix"`
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
}

type backupRetentionPolicy struct {
	Local  backupRetentionLimit       `json:"local"`
	Remote backupRemoteRetentionLimit `json:"remote"`
}

type backupRetentionLimit struct {
	Count        int     `json:"count"`
	Days         int     `json:"days"`
	MaxStorageGB float64 `json:"maxStorageGb"`
}

type backupRemoteRetentionLimit struct {
	Enabled      bool    `json:"enabled"`
	Count        int     `json:"count"`
	Days         int     `json:"days"`
	MaxStorageGB float64 `json:"maxStorageGb"`
}

type backupVolumeSelection struct {
	Mode  string   `json:"mode"`
	Names []string `json:"names"`
}

type backupDatabaseDump struct {
	Format  string `json:"format"`
	Service string `json:"service"`
	Command string `json:"command"`
}

type restoreConfig struct {
	SchemaVersion int               `json:"schemaVersion"`
	BackupRunID   string            `json:"backupRunId"`
	ProjectID     string            `json:"projectId"`
	EnvironmentID string            `json:"environmentId"`
	RuntimeID     string            `json:"runtimeId"`
	Destination   backupDestination `json:"destination"`
	Artifacts     []restoreArtifact `json:"artifacts"`
}

type restoreArtifact struct {
	ID             string `json:"id"`
	Type           string `json:"type"`
	Storage        string `json:"storage"`
	ObjectKey      string `json:"objectKey"`
	ChecksumSHA256 string `json:"checksumSha256"`
	TargetVolume   string `json:"targetVolume"`
	TargetService  string `json:"targetService"`
	RestoreCommand string `json:"restoreCommand"`
}

type jobCompletion struct {
	ServerID     string     `json:"serverId"`
	Token        string     `json:"token"`
	Type         string     `json:"type"`
	DeploymentID string     `json:"deploymentId"`
	Status       string     `json:"status"`
	GitSha       *string    `json:"gitSha"`
	LogStartSeq  int        `json:"logStartSeq,omitempty"`
	Logs         []string   `json:"logs"`
	Events       []jobEvent `json:"events"`
}

type cleanupJobCompletion struct {
	ServerID string `json:"serverId"`
	Token    string `json:"token"`
	Type     string `json:"type"`
	JobID    string `json:"jobId"`
	Status   string `json:"status"`
	Message  string `json:"message,omitempty"`
}

type backupJobCompletion struct {
	ServerID    string           `json:"serverId"`
	Token       string           `json:"token"`
	Type        string           `json:"type"`
	JobID       string           `json:"jobId"`
	BackupRunID string           `json:"backupRunId"`
	Status      string           `json:"status"`
	Message     string           `json:"message,omitempty"`
	Manifest    map[string]any   `json:"manifest,omitempty"`
	Artifacts   []backupArtifact `json:"artifacts,omitempty"`
}

type backupCleanupJobCompletion struct {
	ServerID     string   `json:"serverId"`
	Token        string   `json:"token"`
	Type         string   `json:"type"`
	JobID        string   `json:"jobId"`
	BackupRunIDs []string `json:"backupRunIds"`
	Status       string   `json:"status"`
	Message      string   `json:"message,omitempty"`
}

type restoreJobCompletion struct {
	ServerID string `json:"serverId"`
	Token    string `json:"token"`
	Type     string `json:"type"`
	JobID    string `json:"jobId"`
	Status   string `json:"status"`
	Message  string `json:"message,omitempty"`
}

type backupArtifact struct {
	Type           string `json:"type"`
	Storage        string `json:"storage"`
	ObjectKey      string `json:"objectKey"`
	ChecksumSHA256 string `json:"checksumSha256"`
	SizeBytes      int64  `json:"sizeBytes"`
}

type jobProgress struct {
	ServerID     string     `json:"serverId"`
	Token        string     `json:"token"`
	DeploymentID string     `json:"deploymentId"`
	LogStartSeq  int        `json:"logStartSeq"`
	Logs         []string   `json:"logs"`
	Events       []jobEvent `json:"events"`
}

type statusJobRequest struct {
	ServerID     string `json:"serverId"`
	Token        string `json:"token"`
	DeploymentID string `json:"deploymentId"`
}

type statusJobResponse struct {
	DeploymentID string `json:"deploymentId"`
	Status       string `json:"status"`
}

type jobEvent struct {
	Phase   string `json:"phase"`
	Message string `json:"message"`
}

type progressJobResponse struct {
	OK bool `json:"ok"`
}

type completeJobResponse struct {
	OK bool `json:"ok"`
}
