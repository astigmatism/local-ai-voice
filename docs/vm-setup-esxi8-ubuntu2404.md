# ESXi 8.0 VM setup for Ubuntu Server 24.04 LTS

The appliance is sized around one directly passed-through NVIDIA GPU with roughly 10 GB VRAM. Host RAM and vCPU help the OS, gateway, Python workers, model loading, and buffering. They do not replace VRAM for large GPU models.

## Sizing profiles

| Profile | vCPU | RAM | System disk | Model/cache/data disk | Network | Firmware | Secure Boot | Notes |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| Minimum test VM | 4 | 16 GB | 80 GB | 150 GB | VMXNET3 | UEFI | Disable initially | Enough to boot, test GPU, and run one modest model at a time. |
| Recommended single-GPU VM | 6-8 | 24-32 GB | 100 GB | 250-500 GB | VMXNET3 | UEFI | Disable unless signing NVIDIA modules | Best default for a 10 GB VRAM GPU, STT/TTS switching, and model cache growth. |
| Comfortable development VM | 8-12 | 48-64 GB | 100+ GB | 500 GB-1 TB | VMXNET3 | UEFI | Disable unless managed | Better for experiments, multiple caches, local builds, logs, and test data. |

## Recommended VM hardware settings

| Setting | Recommendation | Rationale |
| --- | --- | --- |
| Compatibility | ESXi 8.0 virtual hardware | Required for current passthrough behavior and Ubuntu 24.04 guest support. |
| Guest OS | Ubuntu Linux 64-bit | Use Ubuntu Server 24.04 LTS. Treat 24.02 as a typo. |
| Firmware | UEFI | Modern NVIDIA drivers and Ubuntu default. |
| Secure Boot | Off for initial deployment | Avoid NVIDIA module signing/MOK issues during first bring-up. |
| Memory reservation | Reserve all guest memory when using PCI passthrough | ESXi often requires or strongly benefits from full memory reservation with passthrough devices. |
| CPU reservation | Usually not required | Add only if host contention is severe. |
| Latency sensitivity | Normal | Raise only if measuring real-time audio latency problems. |
| Network adapter | VMXNET3 | Best-supported VMware paravirtual NIC. |
| Disk controller | VMware Paravirtual SCSI | Good performance for model cache and generated files. |
| Snapshots | Avoid while GPU is attached | Passthrough devices limit snapshot safety/usefulness. Use backups instead. |
| Backup | File-level backup for config/scripts plus model cache policy | Do not assume VM snapshots can capture a clean GPU worker state. |

## Expected resource behavior

Idle appliance:

- Gateway uses low CPU and modest memory.
- Workers use memory for Python runtime, but VRAM should be low if models are unloaded.
- `nvidia-smi` should show no large Python allocations when both workers are unloaded.

Active STT/TTS:

- VRAM usage rises when a model is loaded and remains allocated while loaded.
- STT and TTS are independently loadable/unloadable, but a 10 GB GPU may not hold every large combination at once.
- CPU may spike during audio decoding, preprocessing, model load, or file I/O, but inference should run on CUDA.

## Disk layout suggestion

Use one system disk and one model/data disk if possible:

```text
/dev/sda  Ubuntu system, /, 100 GB
/dev/sdb  /opt/local-ai-voice, 250-500 GB recommended
```

Example for a second disk mounted at `/opt/local-ai-voice`:

```bash
sudo parted /dev/sdb --script mklabel gpt mkpart primary ext4 0% 100%
sudo mkfs.ext4 -L local-ai-voice-data /dev/sdb1
sudo mkdir -p /opt/local-ai-voice
echo 'LABEL=local-ai-voice-data /opt/local-ai-voice ext4 defaults,noatime 0 2' | sudo tee -a /etc/fstab
sudo mount -a
```

## Installation order

1. Create VM without GPU attached, install Ubuntu Server 24.04 LTS, update, and install OpenSSH.
2. Shut down VM.
3. Enable passthrough for GPU functions on ESXi and reboot host if required.
4. Attach GPU PCI functions to the VM.
5. Reserve all guest RAM.
6. Boot Ubuntu and verify `lspci` sees NVIDIA devices.
7. Install NVIDIA driver and verify `nvidia-smi`.
8. Deploy Local AI Voice.

This order makes it easier to troubleshoot whether failures are Ubuntu-related or passthrough-related.
