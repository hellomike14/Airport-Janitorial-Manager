// Replacing the video requires a NEW content-hash version and private object.
// Never overwrite an existing version; prior employee attestations remain historical.
export const employeeTraining = {
  version: "sha256:47de71676d5a50ef6e89ef63b9dee102ff64427150f424ecff8430c663fbf142",
  videoSha256: "47de71676d5a50ef6e89ef63b9dee102ff64427150f424ecff8430c663fbf142",
  title: "New Employee Training",
  duration: 190.122993,
  videoUrl: "/api/employee-training/video",
  objectPath: "/objects/training/new-employee-47de71676d5a.mp4",
  // Same training content, VP9/Opus delivery for browsers without licensed MP4 codecs.
  webmObjectPath: "/objects/training/new-employee-47de71676d5a.webm",
} as const;
