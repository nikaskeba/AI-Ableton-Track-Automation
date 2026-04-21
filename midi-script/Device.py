from __future__ import absolute_import
from .Interface import Interface
from .DeviceParameter import DeviceParameter


class Device(Interface):
    @staticmethod
    def serialize_device(device):
        if device is None:
            return None

        device_id = Interface.save_obj(device)
        return {
            "id": device_id,
            "name": device.name,
            "type": str(device.type),
            "class_name": device.class_name,
        }

    @staticmethod
    def serialize_drum_pad(pad):
        if pad is None:
            return None

        pad_id = Interface.save_obj(pad)

        try:
            chains = pad.chains
            chain_count = len(chains)
        except Exception:
            chain_count = 0

        try:
            note = pad.note
        except Exception:
            note = None

        try:
            name = pad.name
        except Exception:
            name = ""

        return {
            "id": pad_id,
            "name": name,
            "note": note,
            "chain_count": chain_count,
        }

    def __init__(self, c_instance, socket):
        super(Device, self).__init__(c_instance, socket)

    def get_parameters(self, ns):
        return map(DeviceParameter.serialize_device_parameter, ns.parameters)

    def get_type(self, ns):
        return str(ns.type)

    def get_drum_pads(self, ns):
        return map(Device.serialize_drum_pad, ns.drum_pads)
