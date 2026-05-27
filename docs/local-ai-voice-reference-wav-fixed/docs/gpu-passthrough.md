# NVIDIA GPU passthrough on VMware ESXi 8.0

This project assumes direct PCI passthrough / VMDirectPath I/O, not NVIDIA vGPU. vGPU licensing, profiles, and drivers are different and are outside this package.

## High-level ESXi steps

1. Enable host BIOS/UEFI virtualization features:
   - Intel: VT-x and VT-d.
   - AMD: SVM and AMD-Vi/IOMMU.
   - Enable Above 4G Decoding if your platform/GPU requires it.
2. Boot ESXi and verify the GPU appears as a PCI device.
3. In vSphere Client, select the ESXi host.
4. Open **Configure > Hardware > PCI Devices**.
5. Mark the NVIDIA GPU for passthrough.
6. Also mark associated PCI functions if required, commonly NVIDIA HDMI/Audio or USB-C controller functions on the same card.
7. Reboot the ESXi host if vSphere reports that reboot is required.
8. Edit the VM settings and add the PCI device(s).
9. Reserve all guest memory in VM settings.
10. Confirm VM hardware compatibility is appropriate for ESXi 8.0.
11. Boot Ubuntu and verify:

```bash
lspci | grep -i nvidia
sudo dmesg | grep -i nvidia | tail -50
```

12. Install NVIDIA drivers in the guest and verify:

```bash
nvidia-smi
```

## Guest verification commands

```bash
lspci -nn | grep -i nvidia
ls -l /dev/nvidia* || true
nvidia-smi
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv
```

If `lspci` shows the GPU but `nvidia-smi` fails, focus on guest driver/kernel/Secure Boot issues. If `lspci` does not show the GPU, focus on ESXi passthrough assignment, host BIOS, and VM settings.

## Common pitfalls

### Consumer GPU reset behavior

Some consumer GPUs do not reset cleanly after VM reboot. Symptoms include the GPU disappearing, Code 43-like behavior in other guests, or `nvidia-smi` hanging. A full ESXi host reboot may be required. For reliable appliances, prefer workstation/datacenter cards known to reset cleanly.

### Multiple PCI functions

Many GPUs expose multiple PCI functions. Passing only the VGA/3D controller can fail if audio or USB functions remain attached to the host. Pass through all related functions in the same IOMMU group when required.

### Host console or display ownership

If ESXi or the physical console is using the GPU, passthrough may be blocked. Use a separate boot/display adapter or headless host configuration if needed.

### Secure Boot

Ubuntu Secure Boot can prevent unsigned NVIDIA kernel modules from loading. Either enroll MOK keys correctly or disable Secure Boot for the appliance VM.

### Memory reservation

PCI passthrough VMs often require a full memory reservation. In vSphere, set the VM memory reservation equal to configured RAM before power-on.

### Snapshots

Snapshots with passthrough devices can be limited, unsafe, or misleading. Stop services and use file-level backup for config/source where possible.

### vGPU confusion

Direct passthrough gives one VM ownership of the GPU. NVIDIA vGPU partitions a supported GPU and requires different host/guest drivers and licensing. This project assumes direct passthrough.

## Ubuntu NVIDIA driver install

```bash
sudo apt-get update
sudo ubuntu-drivers devices
sudo ubuntu-drivers install
sudo reboot
nvidia-smi
```

If the recommended driver fails, inspect:

```bash
mokutil --sb-state || true
journalctl -k -b | grep -iE 'nvidia|nouveau|secure|module'
lsmod | grep -E 'nvidia|nouveau'
```

Blacklist nouveau only if needed; Ubuntu packages normally handle this.
