# Fake "desktop" for the Kirby+beam e2e test: SSH + tmux + git, the
# three things beam requires of a host. Mirrors beam's own e2e image.
#
# No credentials are baked in: the test generates a throwaway keypair at
# runtime and installs the public half into the running container. The
# fixture repo is likewise created at test time.
FROM alpine:3.20

RUN apk add --no-cache openssh-server tmux git \
    && ssh-keygen -A \
    && mkdir -p /root/.ssh \
    && chmod 700 /root/.ssh \
    && touch /root/.ssh/authorized_keys \
    && chmod 600 /root/.ssh/authorized_keys \
    && sed -i -E '/^[[:space:]]*(PermitRootLogin|PubkeyAuthentication|PasswordAuthentication|UseDNS)[[:space:]]/d' \
        /etc/ssh/sshd_config \
    && printf '%s\n' \
        'PermitRootLogin prohibit-password' \
        'PubkeyAuthentication yes' \
        'PasswordAuthentication no' \
        'UseDNS no' \
        >> /etc/ssh/sshd_config

EXPOSE 22

CMD ["/usr/sbin/sshd", "-D", "-e"]
