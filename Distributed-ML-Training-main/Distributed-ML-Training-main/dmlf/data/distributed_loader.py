from torch.utils.data import DataLoader
from torch.utils.data.distributed import DistributedSampler


def create_distributed_dataloader(dataset, batch_size, is_training, num_workers=0):
    sampler = DistributedSampler(dataset, shuffle=is_training)
    loader = DataLoader(dataset, batch_size=batch_size, sampler=sampler, num_workers=num_workers, pin_memory=False)
    return loader, sampler
